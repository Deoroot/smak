// Texture files (.wad, the WAD3 of Half-Life) read and written, and a map's own found among a game's folders.
//
// A map either carries a texture's pixels inside itself or only names it and leaves the pixels to a .wad
// file, which the engine looks for by name in the game's folders. The worldspawn entity's `wad` key lists
// the files the map was compiled with, as paths on the mapper's machine: only the file names matter.
//
//   reading   readWad textureFromWad
//   writing   writeWad
//   finding   wadsFor texturesFor       (these two look in folders on the disk; nothing else here does)
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readMiptex, writeMiptex, mapTexture, miptexHeader } from "./miptex.mjs";

// ── the format (the engine's wadfile.h) ────────────────────────────────────
const WAD_ID = "WAD3";
/** Quake's own, older kind: the same file, but its textures have no palette of their own. */
const QUAKE_WAD_ID = "WAD2";
const ID_LENGTH = 4;
// dwadinfo_t: the letters, how many entries, and where the table of entries is
const WAD_HEADER = { ident: 0, numlumps: 4, infotableofs: 8, sizeof: 12 };
// dlumpinfo_t: one entry of the table
const ENTRY = {
  filepos: 0,
  disksize: 4,
  size: 8,
  type: 12,
  attribs: 13, // compression: always 0
  name: 16, // char[16]
  sizeof: 32,
};
const ENTRY_NAME_ROOM = 16;
/** What an entry is. A map's texture is a miptex; the others are the menus' pictures and the fonts. */
const TYPE_MIPTEX = 0x43;
const TYPE_NAMES = { 0x40: "spray", 0x42: "picture", 0x43: "texture", 0x46: "font" };
/**
 * The files of every game that hold decals sprayed at run time: the engine never looks in them for a map's
 * textures.
 */
const NEVER_SEARCHED = ["pldecal", "tempdecal"];
const WAD_EXTENSION = ".wad";

// ── small tools ────────────────────────────────────────────────────────────
const padTo4 = (length) => (4 - (length % 4)) % 4;
/** The engine matches texture names whatever their case. */
const sameName = (name) => name.toLowerCase();
const entryName = (bytes, at) => {
  const end = bytes.indexOf(0, at);
  return bytes.toString("latin1", at, end < 0 || end > at + ENTRY_NAME_ROOM ? at + ENTRY_NAME_ROOM : end);
};

// ── reading ────────────────────────────────────────────────────────────────
/**
 * Where a .wad's table of entries is and how many it has: `{ count, table }`. Throws, in words, unless the
 * file is a WAD3.
 */
function wadTable(bytes) {
  if (bytes.length < WAD_HEADER.sizeof) throw new Error(`not a .wad file: it is ${bytes.length} bytes long`);
  const id = bytes.toString("latin1", WAD_HEADER.ident, ID_LENGTH);
  if (id === QUAKE_WAD_ID)
    throw new Error(
      "not a Half-Life .wad: this is a Quake one (WAD2), whose textures share one palette that is not in the file",
    );
  if (id !== WAD_ID) throw new Error(`not a .wad file: it begins with ${JSON.stringify(id)}, not ${WAD_ID}`);
  const count = bytes.readInt32LE(WAD_HEADER.numlumps);
  const table = bytes.readInt32LE(WAD_HEADER.infotableofs);
  if (count < 0 || table < 0 || table + count * ENTRY.sizeof > bytes.length)
    throw new Error(
      `the .wad is cut short: its table of ${count} entries at ${table} runs past its ${bytes.length} bytes`,
    );
  return { count, table };
}

/**
 * A .wad file: `{ textures, others }`. `textures`: every map texture in it, in the file's order, each
 * `{ name, width, height, pixels, palette, mips, holes }` (see miptex.mjs; the pixels are views of `bytes`).
 * `others`: what else it holds, `[{ name, kind }]` (menu pictures, fonts), which is not read. Throws, in
 * words, unless the file is a WAD3.
 */
export function readWad(bytes) {
  const { count, table } = wadTable(bytes);
  const textures = [];
  const others = [];
  for (let entry = 0; entry < count; entry++) {
    const at = table + entry * ENTRY.sizeof;
    const type = bytes[at + ENTRY.type];
    const name = entryName(bytes, at + ENTRY.name);
    if (type !== TYPE_MIPTEX) {
      others.push({ name, kind: TYPE_NAMES[type] ?? `type ${type}` });
      continue;
    }
    const texture = readMiptex(bytes, bytes.readInt32LE(at + ENTRY.filepos));
    // the table's name is the one the engine goes by; the one in the texture's own header can differ in case
    if (texture) textures.push({ ...texture, name });
  }
  return { textures, others };
}

/**
 * The names and sizes of a .wad's textures, with no pixels read: `[{ name, width, height }]`. For looking
 * through the big files of a game quickly.
 */
function wadDirectory(bytes) {
  const { count, table } = wadTable(bytes);
  const names = [];
  for (let entry = 0; entry < count; entry++) {
    const at = table + entry * ENTRY.sizeof;
    if (bytes[at + ENTRY.type] !== TYPE_MIPTEX) continue;
    const header = miptexHeader(bytes, bytes.readInt32LE(at + ENTRY.filepos));
    names.push({ name: entryName(bytes, at + ENTRY.name), width: header.width, height: header.height });
  }
  return names;
}

/**
 * One texture of a .wad by its name, whatever the case: the texture, or undefined. `wad` is the file's bytes
 * or what `readWad` gave.
 */
export function textureFromWad(wad, name) {
  const textures = wad.textures ?? readWad(wad).textures;
  return textures.find((texture) => sameName(texture.name) === sameName(name));
}

// ── writing ────────────────────────────────────────────────────────────────
/**
 * A .wad file holding the given textures. Each is `{ name, image }`, an image `{ width, height, rgb }` or
 * `{ width, height, rgba }` that is cut down to 256 colours here, or `{ name, width, height, pixels,
 * palette }`, kept index for index. The three smaller sizes of each are made by shrinking (miptex.mjs says
 * how);
 * a texture whose name begins with `{` has holes where its picture is see-through (or its index is 255).
 * Both sides of a texture must be multiples of 16, and its name fifteen letters at the most.
 */
export function writeWad(textures) {
  const seen = new Set();
  const blocks = textures.map((source) => {
    const texture = mapTexture(source);
    if (seen.has(sameName(texture.name)))
      throw new Error(
        `the texture ${texture.name} is given twice: the engine would only ever find the first`,
      );
    seen.add(sameName(texture.name));
    return { name: texture.name, bytes: writeMiptex(texture) };
  });
  // the header, then the textures one after another, each on a multiple of four, then the table
  const parts = [Buffer.alloc(WAD_HEADER.sizeof)];
  let size = WAD_HEADER.sizeof;
  const table = Buffer.alloc(blocks.length * ENTRY.sizeof);
  blocks.forEach((block, entry) => {
    const at = entry * ENTRY.sizeof;
    table.writeInt32LE(size, at + ENTRY.filepos);
    table.writeInt32LE(block.bytes.length, at + ENTRY.disksize);
    table.writeInt32LE(block.bytes.length, at + ENTRY.size);
    table[at + ENTRY.type] = TYPE_MIPTEX;
    table.write(block.name, at + ENTRY.name, ENTRY_NAME_ROOM - 1, "latin1");
    const pad = Buffer.alloc(padTo4(block.bytes.length));
    parts.push(block.bytes, pad);
    size += block.bytes.length + pad.length;
  });
  parts[0].write(WAD_ID, WAD_HEADER.ident, ID_LENGTH, "latin1");
  parts[0].writeInt32LE(blocks.length, WAD_HEADER.numlumps);
  parts[0].writeInt32LE(size, WAD_HEADER.infotableofs);
  parts.push(table);
  return Buffer.concat(parts);
}

// ── finding a map's ────────────────────────────────────────────────────────
/**
 * The .wad files a map's worldspawn lists, as the engine looks for them: the file name of each path, in
 * lower case, with `.wad` put on when it has no extension, in the order listed and each once.
 */
export function listedWads(wadValue) {
  const names = [];
  for (const path of (wadValue ?? "").split(";")) {
    const file = path.trim().replace(/\\/g, "/").split("/").pop().toLowerCase();
    if (!file) continue;
    const base = file.replace(/\.[^.]*$/, "");
    if (NEVER_SEARCHED.some((never) => base.includes(never))) continue;
    const name = `${base}${WAD_EXTENSION}`;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** The files of a folder by their names in lower case, or nothing when it is not a folder. */
function filesOf(folder) {
  const byName = new Map();
  try {
    for (const file of readdirSync(folder))
      if (!byName.has(file.toLowerCase())) byName.set(file.toLowerCase(), file);
  } catch {
    // a folder that is not there holds no files
  }
  return byName;
}

/**
 * The folders a map's own file says its .wad files are in: its own folder, and when that is a mod's `maps`
 * folder, the mod's folder over it, where the game looks (the original mod's maker found its fw.wad at the
 * mod's root told as missing, 2026-10-17).
 */
export function mapOwnFolders(file) {
  const own = dirname(file);
  return basename(own).toLowerCase() === "maps" ? [own, dirname(own)] : [own];
}

/**
 * Where a map's .wad files are: `{ found: [{ name, path }], missing: [name] }`. `bsp` is what `readBsp`
 * gave; `folders` the game's folders to look in, in the order the engine would (the mod's own first, then
 * `valve`). A name is matched whatever its case.
 */
export function wadsFor(bsp, folders) {
  const worldspawn = bsp.entities[0] ?? [];
  const listed = worldspawn.find((pair) => pair[0] === "wad");
  const found = [];
  const missing = [];
  const files = folders.map((folder) => ({ folder, byName: filesOf(folder) }));
  for (const name of listedWads(listed?.[1])) {
    const holder = files.find((each) => each.byName.has(name));
    if (holder) found.push({ name, path: join(holder.folder, holder.byName.get(name)) });
    else missing.push(name);
  }
  return { found, missing };
}

/**
 * Every texture a map wants from .wad files, looked for in the game's folders: `{ wads, textures, missing,
 * unreadable }`.
 * `wads` is what `wadsFor` gives. `textures`: `[{ name, wad, path }]`, the first listed file that has each.
 * `missing`: the names no listed file has. `unreadable`: the listed files that were found and could not be
 * read as a .wad, `[{ name, path, reason }]`. With `{ pixels: true }` each found texture also brings its
 * `texture` (see miptex.mjs), read from its file.
 */
export function texturesFor(bsp, folders, { pixels = false } = {}) {
  const wads = wadsFor(bsp, folders);
  const wanted = bsp.textures.filter((texture) => !texture.absent && !texture.embedded);
  const opened = [];
  const unreadable = [];
  for (const wad of wanted.length ? wads.found : []) {
    try {
      const bytes = readFileSync(wad.path);
      const names = new Set(wadDirectory(bytes).map((entry) => sameName(entry.name)));
      opened.push({ ...wad, bytes, names });
    } catch (e) {
      // a file of that name that is not a .wad the kit reads: told about, and the others still looked in
      unreadable.push({ ...wad, reason: e.message });
    }
  }
  const textures = [];
  const missing = [];
  for (const { name } of wanted) {
    const holder = opened.find((wad) => wad.names.has(sameName(name)));
    if (!holder) {
      missing.push(name);
      continue;
    }
    const found = { name, wad: holder.name, path: holder.path };
    if (pixels) {
      holder.read ??= readWad(holder.bytes);
      found.texture = textureFromWad(holder.read, name);
    }
    textures.push(found);
  }
  return { wads, textures, missing, unreadable };
}
