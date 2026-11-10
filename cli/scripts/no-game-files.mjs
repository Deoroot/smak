#!/usr/bin/env node
// Proof that no game file is committed: every file git tracks, held against every file of the game's folders.
//
//   node cli/scripts/no-game-files.mjs [--history] [<game folder> ...]
//
// The game folders are a mod's own (Half-Life's valve, The Specialists' ts, Master Sword's msr...); unless told,
// valve and ts in Steam's Half-Life folder, where Steam puts it on Windows or Linux.
//
// --history: every version of every file ever committed (each blob in the repository's history), not only the
// files tracked now: a game file once committed and later removed is still in the history.
//
// Three ways a game's file could come in, each checked:
//   1. the same bytes: a tracked file whose SHA-256 is a game file's
//   2. a game texture taken out as a picture: a tracked PNG, BMP or JPEG whose pixels (as RGB) are a texture's
//      of a game .wad or a texture inside a game .mdl
//   3. a game sound copied as samples: a tracked .wav whose samples, read as numbers, are a game sound's
// It prints what it found and exits 1 on any match. Nothing is written. The game's folders are only read.
//
// From stevenlafl/smak (a4be16e and later), with a .wav reader of its own and Windows' Steam folder.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readWad } from "../../core/maps/wad.mjs";
import { readMdl, textureOf, withTextures } from "../../core/mdl.mjs";
import { rgbaOf, unpng, unbmp } from "../../core/image.mjs";
import { unjpeg } from "../../core/jpeg.mjs";

const KIT = resolve(fileURLToPath(import.meta.url), "../../..");
const STEAM_HL = [
  join(homedir(), ".steam/steam/steamapps/common/Half-Life"),
  "C:/Program Files (x86)/Steam/steamapps/common/Half-Life",
];
const history = process.argv.includes("--history");
const given = process.argv.slice(2).filter((a) => a !== "--history");
const games = given.length
  ? given
  : STEAM_HL.flatMap((hl) => ["valve", "ts"].map((g) => join(hl, g))).filter(existsSync);
if (!games.length) {
  console.error("no game folder: name one (node cli/scripts/no-game-files.mjs <folder> ...)");
  process.exit(2);
}
const missing = games.filter((game) => !existsSync(game));
if (missing.length) {
  console.error(`no such folder: ${missing.join(", ")}`);
  process.exit(2);
}

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** A picture's pixels as RGB alone, with its size: the same for a PNG, a BMP or a texture of the same picture. */
const rgbKey = (width, height, rgba) => {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  return `${width}x${height}:${sha(rgb)}`;
};
/** A picture file's pixels, { width, height, rgba }: PNG, BMP (of 8 bits or more) or JPEG. */
function pictureOf(bytes) {
  const opaque = ({ width, height, rgb }) => {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4);
    return { width, height, rgba };
  };
  if (bytes.toString("latin1", 0, 2) === "BM") {
    const read = unbmp(bytes);
    return read.pixels ? { width: read.width, height: read.height, rgba: rgbaOf(read) } : opaque(read);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return opaque(unjpeg(bytes));
  return unpng(bytes);
}
/** A PCM .wav file's samples, each as a whole number of 16 bits: the same sound at 8 or 16 bits keys alike. */
function samplesOf(bytes) {
  if (bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WAVE") throw new Error("not a .wav");
  let at = 12;
  let bits = 0;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("latin1", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === "fmt ") bits = bytes.readUInt16LE(at + 8 + 14);
    if (id === "data") {
      const data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size));
      if (bits === 8) return Int16Array.from(data, (v) => (v - 128) * 256);
      if (bits === 16) return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~1)));
      throw new Error(`a .wav of ${bits} bits`);
    }
    at += 8 + size + (size & 1);
  }
  throw new Error("a .wav with no data");
}
const samplesKey = (samples) => sha(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));

function* filesUnder(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* filesUnder(p);
    else if (e.isFile()) yield p;
  }
}

// the game's files: their bytes, their textures' pixels and their sounds' samples, each by hash
const bytesOf = new Map();
const picturesOf = new Map();
const soundsOf = new Map();
const counted = { files: 0, textures: 0, sounds: 0 };
for (const game of games)
  for (const file of filesUnder(game)) {
    const ext = extname(file).toLowerCase();
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch {
      continue;
    }
    counted.files++;
    bytesOf.set(sha(bytes), file);
    try {
      if (ext === ".wad")
        for (const t of readWad(bytes).textures) {
          picturesOf.set(rgbKey(t.width, t.height, rgbaOf(t)), `${file} ${t.name}`);
          counted.textures++;
        }
      else if (ext === ".mdl" && !/t\.mdl$|\d\d\.mdl$/i.test(file)) {
        const outside = file.replace(/\.mdl$/i, "t.mdl");
        const t = existsSync(outside) ? withTextures(bytes, readFileSync(outside)) : bytes;
        const info = readMdl(t);
        for (let i = 0; i < info.textures.length; i++) {
          const tex = textureOf(t, i);
          if (!tex.pixels?.length) continue;
          picturesOf.set(rgbKey(tex.width, tex.height, rgbaOf(tex)), `${file} ${tex.name}`);
          counted.textures++;
        }
      } else if (ext === ".wav") {
        soundsOf.set(samplesKey(samplesOf(bytes)), file);
        counted.sounds++;
      }
    } catch {
      // a file the kit does not read (a Source model, a broken sound): its bytes are still held
    }
  }

// the kit's files, each held against them: those tracked now, or with --history every blob ever committed (by a
// path it had)
const git = (args, options = {}) => execFileSync("git", ["-C", KIT, ...args], { maxBuffer: 1 << 30, ...options });
const blobs = () => {
  const named = new Map(
    git(["rev-list", "--objects", "--all"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.includes(" "))
      .map((line) => [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)]),
  );
  const kinds = git(["cat-file", "--batch-check=%(objecttype)"], { input: [...named.keys()].join("\n"), encoding: "utf8" }).split("\n"); // prettier-ignore
  return [...named.entries()]
    .filter((_, i) => kinds[i] === "blob")
    .map(([id, name]) => ({ name: `${name} (${id.slice(0, 10)})`, path: name, read: () => git(["cat-file", "blob", id]) }));
};
const tracked = history
  ? blobs()
  : git(["ls-files", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter((name) => name && statSync(join(KIT, name), { throwIfNoEntry: false })?.isFile())
      .map((name) => ({ name, path: name, read: () => readFileSync(join(KIT, name)) }));
const found = [];
for (const { name, path, read } of tracked) {
  const bytes = read();
  const same = bytesOf.get(sha(bytes));
  if (same) found.push(`${name}: the same bytes as ${same}`);
  const ext = extname(path).toLowerCase();
  try {
    if ([".png", ".bmp", ".jpg", ".jpeg"].includes(ext)) {
      const p = pictureOf(bytes);
      const match = picturesOf.get(rgbKey(p.width, p.height, p.rgba));
      if (match) found.push(`${name}: the pixels of the game's texture ${match}`);
    } else if (ext === ".wav") {
      const match = soundsOf.get(samplesKey(samplesOf(bytes)));
      if (match) found.push(`${name}: the samples of the game's sound ${match}`);
    }
  } catch {
    // not a picture or a sound the kit reads: its bytes were held above
  }
}
console.log(
  `${tracked.length} ${history ? "file versions in the history" : "tracked files"} held against ${counted.files} files of ${games.join(", ")} (${counted.textures} textures, ${counted.sounds} sounds)`,
);
if (found.length) {
  console.log(`FOUND ${found.length}:\n${found.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("none of them is a game file, a game texture's pixels or a game sound's samples");
