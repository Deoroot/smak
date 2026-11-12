// Frames made a clip: the pictures a browser filmed, with their moments, as an MP4 at a steady rate through ffmpeg
// (`smak play`'s film), and a looping GIF written here with nothing installed (`smak gif`, anim-gif.mjs).
//
//   encodeTimed(frames, { fps, crf }) -> bytes (MP4; needs ffmpeg)    hasFfmpeg() -> whether it is there
//   gifFrame(frame) -> { palette, data }                              gif(frames, { width, height, fps }) -> bytes
import { spawn, spawnSync } from "node:child_process";
import { indexed } from "../core/image.mjs";

/**
 * Pictures that came with their moments (a browser's screencast: a JPEG each time the page was drawn, `[{ at,
 * jpeg }]`, `at` in milliseconds) as an MP4 at a steady rate: each moment of the rate shows the last picture
 * drawn by then, so a stretch the page drew slowly is held and none is played fast. Needs ffmpeg.
 */
export async function encodeTimed(frames, { fps = 30, crf = 20 } = {}) {
  if (!frames.length) throw new Error("encodeTimed: no frames: was the page drawn while it was filmed?");
  if (!hasFfmpeg()) throw new Error("encodeTimed: a clip is made with ffmpeg, and there is none on the PATH");
  const out = [];
  let err = "";
  const ff = spawn("ffmpeg", ["-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart+frag_keyframe+empty_moov", "-f", "mp4", "-"], { stdio: ["pipe", "pipe", "pipe"] }); // prettier-ignore
  ff.stdout.on("data", (d) => out.push(d));
  ff.stderr.on("data", (d) => (err += d));
  const closed = new Promise((done) => ff.on("close", (status) => done(status)));
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  const step = 1000 / fps;
  const end = sorted[sorted.length - 1].at;
  let shown = 0;
  for (let t = sorted[0].at; t <= end; t += step) {
    while (shown + 1 < sorted.length && sorted[shown + 1].at <= t) shown++;
    if (!ff.stdin.write(sorted[shown].jpeg)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  const status = await closed;
  if (status) throw new Error(`ffmpeg: ${err.trim().split("\n").slice(-2).join(" ")}`);
  return Buffer.concat(out);
}

/** Whether ffmpeg is on the machine. */
export const hasFfmpeg = () => spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

// ── a GIF of our own ──────────────────────────────────────────────────────

/** One frame's palette and LZW-packed indices, as gif() takes it. */
export function gifFrame(frame) {
  const rgb = new Uint8Array(frame.width * frame.height * 3);
  for (let i = 0; i < frame.width * frame.height; i++) rgb.set(frame.rgba.subarray(i * 4, i * 4 + 3), i * 3);
  const texture = indexed({ width: frame.width, height: frame.height, rgb }, "frame", 256);
  return { palette: texture.palette, data: lzw(texture.pixels, 8) };
}

/** GIF's LZW: codes growing from min + 1 bits to 12, a clear code when the table is full. */
function lzw(pixels, min) {
  const clear = 1 << min;
  const end = clear + 1;
  const bytes = [];
  let bits = 0;
  let acc = 0;
  let size = min + 1;
  const put = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  let table = new Map();
  let next = end + 1;
  put(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const p = pixels[i];
    const key = prefix * 256 + p;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    put(prefix);
    if (next < 4096) {
      table.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      put(clear);
      table = new Map();
      next = end + 1;
      size = min + 1;
    }
    prefix = p;
  }
  put(prefix);
  put(end);
  if (bits) bytes.push(acc & 255);
  return Uint8Array.from(bytes);
}

/** A looping GIF89a of frames (each { palette, data } from gifFrame), shown 1/fps seconds each. */
export function gif(frames, { width, height, fps = 15 }) {
  const parts = [];
  const header = Buffer.alloc(13);
  header.write("GIF89a", 0, "latin1");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  header[10] = 0; // no global colour table
  parts.push(header);
  // loop for ever
  parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "latin1"), 0x03, 0x01, 0x00, 0x00, 0x00]));
  const delay = Math.max(2, Math.round(100 / fps));
  for (const f of frames) {
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x00, delay & 255, delay >> 8, 0x00, 0x00]));
    const image = Buffer.alloc(10);
    image[0] = 0x2c;
    image.writeUInt16LE(width, 5);
    image.writeUInt16LE(height, 7);
    image[9] = 0x87; // a local colour table of 256
    parts.push(image, Buffer.from(f.palette.subarray(0, 768)), Buffer.from([8]));
    for (let i = 0; i < f.data.length; i += 255) {
      const chunk = f.data.subarray(i, i + 255);
      parts.push(Buffer.from([chunk.length]), Buffer.from(chunk));
    }
    parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
