// A video of models and maps, directed by a shot list (research/directed-video.md): each shot a kind of
// camera move drawn frame by frame by the kit's own renderer, checked for smoothness (no frame jumps from the
// one before) and, in a map, for an eye too near a wall, previewed as a contact sheet, and encoded: MP4
// (H.264) through ffmpeg when the machine has it, a GIF written here when it does not.
//
//   framesOfShot(shot, context)  -> { count, notes, frames() }: frames() yields, for each frame, a function
//                                   that draws it (so a preview draws only the frames it shows)
//   encode(frames, { file, fps, width, height, format }) -> { file, bytes, format }
//   gif(frames, { fps }) -> bytes
//
// Shot kinds: title, turntable, sheet, animations, walk, flyover, path.
import { spawn, spawnSync } from "node:child_process";
import { render, framing, sheet as sheetOf, label, tile } from "../make/render.mjs";
import { sequences } from "../core/mdl.mjs";
import { indexed } from "../core/image.mjs";
import * as maps from "./maps/index.mjs";
import { walkPath, lookAhead, simplify, curveOf, ease } from "../make/camera.mjs";

const DARK = [24, 26, 30];

/** A plain picture of `width` x `height` in one colour. */
const plain = (width, height, colour = DARK) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...colour, 255], i * 4);
  return { width, height, rgba };
};

/** A picture fitted into `width` x `height`, centred, enlarged or shrunk by nearest pixels. */
function fitted(picture, width, height) {
  const k = Math.min(width / picture.width, height / picture.height);
  const w = Math.max(1, Math.round(picture.width * k));
  const h = Math.max(1, Math.round(picture.height * k));
  const out = plain(width, height);
  const ox = Math.floor((width - w) / 2);
  const oy = Math.floor((height - h) / 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(picture.width - 1, Math.floor(x / k));
      const sy = Math.min(picture.height - 1, Math.floor(y / k));
      const i = (sy * picture.width + sx) * 4;
      out.rgba.set(picture.rgba.subarray(i, i + 4), ((oy + y) * width + ox + x) * 4);
    }
  return out;
}

/** A caption written on the bottom of a frame. */
function captioned(picture, caption) {
  if (!caption) return picture;
  label(picture, caption, 12, picture.height - 28);
  return picture;
}

/** The animation of a model by name or number, and its frame count and rate. */
function animationOf(src, seq) {
  const all = sequences(src);
  const index = seq === undefined ? 0 : typeof seq === "number" ? seq : all.findIndex((s) => s.name === seq);
  if (index < 0 || !all[index]) throw new Error(`no animation ${seq}: ${all.map((s) => s.name).join(", ")}`);
  return { index, frames: all[index].frames ?? all[index].numframes ?? 1, fps: all[index].fps ?? 30 };
}

/**
 * A shot's frames. `context`: { fps, width, height, model(name) -> bytes, map(name) -> bytes, folders }.
 * Returns { count, notes, frames() } where frames() yields each frame (so a long shot is never held whole).
 */
export function framesOfShot(shot, { fps, width, height, model, map, folders = [] }) {
  const seconds = shot.seconds ?? 4;
  const notes = [];
  if (shot.kind === "title") {
    const count = Math.max(1, Math.round(seconds * fps));
    return {
      count,
      notes,
      *frames() {
        const picture = plain(width, height);
        const k = 4;
        label(picture, shot.text ?? "", Math.max(8, Math.round(width / 2 - (shot.text ?? "").length * 4 * k * 0.5)), Math.round(height / 2 - 3 * k), k);
        if (shot.caption) captioned(picture, shot.caption);
        for (let n = 0; n < count; n++) yield () => picture;
      },
    };
  }
  if (["turntable", "sheet", "animations"].includes(shot.kind)) {
    const src = model(shot.model);
    if (shot.kind === "animations") {
      const seqs = shot.seqs ?? [0];
      const plans = seqs.map((seq) => {
        const a = animationOf(src, seq);
        const length = shot.each ?? Math.max(1, (a.frames - 1) / a.fps);
        return { a, seq, count: Math.max(1, Math.round(length * fps)) };
      });
      const within = framing(src, plans.flatMap(({ a }) => Array.from({ length: a.frames }, (_, f) => ({ seq: a.index, frame: f }))));
      return {
        count: plans.reduce((s, p) => s + p.count, 0),
        notes,
        *frames() {
          for (const { a, seq, count } of plans)
            for (let n = 0; n < count; n++) {
              const frame = ((n / fps) * a.fps) % Math.max(1, a.frames - 1);
              const view = shot.view === "side" ? { view: "side" } : { yaw: shot.yaw ?? 30, pitch: shot.pitch ?? 10 };
              yield () => captioned(render(src, { ...view, seq: a.index, frame, within, width, height, ground: shot.ground && shot.view === "side" }), shot.caption ?? `${typeof seq === "number" ? `animation ${seq}` : seq}`);
            }
        },
      };
    }
    const a = shot.seq !== undefined ? animationOf(src, shot.seq) : null;
    const poses = a ? Array.from({ length: a.frames }, (_, f) => ({ seq: a.index, frame: f })) : [{ seq: 0, frame: shot.frame ?? 0 }];
    const within = framing(src, poses);
    const count = Math.max(1, Math.round(seconds * fps));
    return {
      count,
      notes,
      *frames() {
        for (let n = 0; n < count; n++) {
          const t = n / fps;
          const pose = a ? { seq: a.index, frame: (t * a.fps) % Math.max(1, a.frames - 1) } : poses[0];
          if (shot.kind === "sheet") {
            const size = Math.floor(Math.min(width / 3, height / 2));
            yield () => captioned(fitted(sheetOf(src, { ...pose, within, size }), width, height), shot.caption);
          } else {
            const yaw = (shot.from ?? 20) + (360 * (shot.turns ?? 1) * n) / count;
            yield () => captioned(render(src, { ...pose, yaw, pitch: shot.pitch ?? 10, zoom: shot.zoom ?? 1, within, width, height, body: shot.body ?? 0, skin: shot.skin ?? 0 }), shot.caption);
          }
        }
      },
    };
  }
  // the map shots
  const bsp = maps.readBsp(map(shot.map));
  const draw = (from, yaw, pitch, fov = shot.fov ?? 90) =>
    maps.drawMap(bsp, { from, yaw, pitch, fov, width, height, folders, entities: shot.entities ?? "game", labels: false, brightness: shot.brightness });
  // the eye in solid (contents -2) is a frame of wall from inside
  const nearWall = (eye) => (maps.contentsAt(bsp, eye) === -2 ? "solid" : null);
  if (shot.kind === "walk") {
    // from a place (an entity's class, name or number, as the walk test takes them; or a point where the feet are)
    const from = shot.from === undefined ? undefined : Array.isArray(shot.from) ? [shot.from] : [shot.from];
    const reach = maps.reachOf(bsp, { ...(from ? { from } : {}), to: [shot.to] });
    const route = reach.routes?.[0]?.points;
    if (!route?.length) throw new Error(`walk: the walk test found no way from ${shot.from ?? "the places to start"} to ${shot.to}${reach.warnings.length ? `: ${reach.warnings.filter((w) => /^to:/.test(w)).join("; ")}` : ""}`);
    const eyeHeight = shot.eye ?? 64;
    const points = simplify(route.map((p) => [p[0], p[1], p[2] + eyeHeight]), 24);
    const eyes = walkPath(points, { speed: shot.speed ?? 160, fps, easing: "both" });
    const looks = lookAhead(eyes, { ahead: Math.round(fps * 0.5), smooth: Math.round(fps * 0.5) });
    return {
      count: eyes.length,
      notes,
      *frames() {
        for (let n = 0; n < eyes.length; n++) {
          const hit = nearWall(eyes[n]);
          if (hit) notes.push(`frame ${n}: the eye is in ${hit} at ${eyes[n].map(Math.round).join(" ")}`);
          const [eye, look] = [eyes[n], looks[n]];
          yield () => captioned(draw(eye, look.yaw, look.pitch), shot.caption);
        }
      },
    };
  }
  const { mins, maxs } = bsp.models[0];
  const middle = mins.map((v, i) => (v + maxs[i]) / 2);
  if (shot.kind === "flyover") {
    const count = Math.max(1, Math.round(seconds * fps));
    const radius = Math.hypot(maxs[0] - mins[0], maxs[1] - mins[1]) * 0.75;
    return {
      count,
      notes,
      *frames() {
        for (let n = 0; n < count; n++) {
          const turn = ((shot.from ?? 225) + (360 * (shot.turns ?? 0.5) * n) / count) * (Math.PI / 180);
          const eye = [middle[0] + Math.cos(turn) * radius, middle[1] + Math.sin(turn) * radius, maxs[2] + (shot.height ?? 400)];
          const yaw = ((Math.atan2(middle[1] - eye[1], middle[0] - eye[0]) * 180) / Math.PI + 360) % 360;
          // looking at the map's middle (unless a pitch is given): the whole of it in the frame as it turns
          const look = shot.pitch ?? (Math.atan2(middle[2] - eye[2], radius) * 180) / Math.PI;
          yield () => captioned(draw(eye, yaw, look, shot.fov ?? 75), shot.caption);
        }
      },
    };
  }
  if (shot.kind === "path") {
    const keys = shot.keys ?? [];
    if (keys.length < 2) throw new Error("path: two keys at least, each { t, at, look, fov }");
    const curve = curveOf(keys.map((k) => k.at));
    const duration = keys.at(-1).t ?? seconds;
    const count = Math.max(2, Math.round(duration * fps) + 1);
    const eyes = Array.from({ length: count }, (_, n) => curve.at(ease("both", n / (count - 1))));
    const ahead = lookAhead(eyes, { ahead: Math.round(fps * 0.5) });
    // a key's fixed look is held from its time to the next key's
    const lookOf = (n) => {
      const t = (n / (count - 1)) * duration;
      const key = [...keys].reverse().find((k) => (k.t ?? 0) <= t) ?? keys[0];
      if (Array.isArray(key.look)) {
        const d = key.look.map((v, i) => v - eyes[n][i]);
        return { yaw: (Math.atan2(d[1], d[0]) * 180) / Math.PI, pitch: (Math.atan2(d[2], Math.hypot(d[0], d[1])) * 180) / Math.PI, fov: key.fov };
      }
      return { ...ahead[n], fov: key.fov };
    };
    return {
      count,
      notes,
      *frames() {
        for (let n = 0; n < count; n++) {
          const look = lookOf(n);
          const eye = eyes[n];
          const hit = nearWall(eye);
          if (hit) notes.push(`frame ${n}: the eye is in ${hit}`);
          yield () => captioned(draw(eye, look.yaw, look.pitch, look.fov ?? 90), shot.caption);
        }
      },
    };
  }
  throw new Error(`no shot kind ${shot.kind}: title, turntable, sheet, animations, walk, flyover, path`);
}

/** How much each frame differs from the one before (mean absolute difference, 0 to 255). */
export function frameStep(a, b) {
  if (!a || a.width !== b.width) return 0;
  let s = 0;
  for (let i = 0; i < a.rgba.length; i += 4) s += Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
  return s / (a.rgba.length * 0.75);
}

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

/**
 * An encoder for frames of one size: push(frame) as they come, then finish() -> bytes. MP4 (H.264) through
 * ffmpeg reading raw frames on its standard input; a GIF of our own otherwise (or when asked).
 */
export function encoder({ width, height, fps, format }) {
  if (format === "mp4") {
    const out = [];
    const ff = spawn("ffmpeg", ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-", "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart+frag_keyframe+empty_moov", "-f", "mp4", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    ff.stdout.on("data", (d) => out.push(d));
    ff.stderr.on("data", (d) => (err += d));
    const closed = new Promise((done) => ff.on("close", (status) => done(status)));
    return {
      async push(frame) {
        if (!ff.stdin.write(Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.length))) await new Promise((r) => ff.stdin.once("drain", r));
      },
      // a video given up (a shot failed): ffmpeg stopped, or it waits on its input for ever
      abort() {
        ff.kill("SIGKILL");
      },
      async finish() {
        ff.stdin.end();
        const status = await closed;
        if (status) throw new Error(`ffmpeg: ${err.trim().split("\n").slice(-2).join(" ")}`);
        return Buffer.concat(out);
      },
    };
  }
  const frames = [];
  return {
    async push(frame) {
      frames.push(gifFrame(frame));
    },
    abort() {},
    async finish() {
      return gif(frames, { width, height, fps });
    },
  };
}

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

/** A contact sheet: four frames a shot, each labelled with its shot and time. */
export function contactSheet(rows, { width = 240 } = {}) {
  const cells = rows.flatMap(({ shot, frames }) => frames.map(({ picture, t }) => ({ picture: fitted(picture, width, Math.round((width * 9) / 16)), name: `${shot} ${t.toFixed(1)}s` })));
  return tile(cells.map((c) => c.picture), 4, cells.map((c) => c.name));
}
