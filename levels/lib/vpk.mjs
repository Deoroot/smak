// Valve's packs (`pak01_dir.vpk` and its `pak01_NNN.vpk`), read so a survey can look inside a game's own
// files where it lies (a door's model, for its size). Version 1 and 2. Nothing is written out.
//
//   openVpk(dirPath)      { files: Map(path -> entry), has(path), read(path) -> Buffer | null }
//   openVpks(dirPaths)    the same over several packs, the first that holds a file winning
import fs from "node:fs";

const SIGNATURE = 0x55aa1234;
const IN_DIR = 0x7fff;

export function openVpk(dirPath) {
  const b = fs.readFileSync(dirPath);
  if (b.readUInt32LE(0) !== SIGNATURE) throw new Error(`vpk: ${dirPath} is not a pack's directory`);
  const version = b.readUInt32LE(4);
  const treeSize = b.readUInt32LE(8);
  const header = version === 1 ? 12 : version === 2 ? 28 : null;
  if (header === null) throw new Error(`vpk: version ${version}; only 1 and 2 are read`);
  let o = header;
  const text = () => {
    const begins = o;
    while (b[o]) o++;
    return b.toString("latin1", begins, o++);
  };
  const files = new Map();
  for (;;) {
    const ext = text();
    if (!ext) break;
    for (;;) {
      const dir = text();
      if (!dir) break;
      for (;;) {
        const name = text();
        if (!name) break;
        const preload = b.readUInt16LE(o + 4);
        const archive = b.readUInt16LE(o + 6);
        const offset = b.readUInt32LE(o + 8);
        const length = b.readUInt32LE(o + 12);
        o += 18;
        const preloadAt = o;
        o += preload;
        const path = `${dir === " " ? "" : `${dir}/`}${name}.${ext}`.toLowerCase();
        files.set(path, { archive, offset, length, preload, preloadAt });
      }
    }
  }
  const dataStart = header + treeSize;
  const base = dirPath.replace(/_dir\.vpk$/i, "");
  const read = (path) => {
    const entry = files.get(path.toLowerCase().replace(/\\/g, "/"));
    if (!entry) return null;
    const parts = [b.subarray(entry.preloadAt, entry.preloadAt + entry.preload)];
    if (entry.length) {
      if (entry.archive === IN_DIR) parts.push(b.subarray(dataStart + entry.offset, dataStart + entry.offset + entry.length));
      else {
        const fd = fs.openSync(`${base}_${String(entry.archive).padStart(3, "0")}.vpk`, "r");
        const chunk = Buffer.alloc(entry.length);
        fs.readSync(fd, chunk, 0, entry.length, entry.offset);
        fs.closeSync(fd);
        parts.push(chunk);
      }
    }
    return Buffer.concat(parts);
  };
  return { files, has: (path) => files.has(path.toLowerCase()), read };
}

export function openVpks(dirPaths) {
  const packs = dirPaths.filter((path) => fs.existsSync(path)).map(openVpk);
  return {
    packs,
    has: (path) => packs.some((pack) => pack.has(path)),
    read: (path) => {
      for (const pack of packs) if (pack.has(path)) return pack.read(path);
      return null;
    },
    list: (test) => [...new Set(packs.flatMap((pack) => [...pack.files.keys()].filter(test)))],
  };
}
