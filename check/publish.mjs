// Before a folder is shared (a map, a model, a mod's files put on a page or in a zip): what in it is not the
// person's to share, or says more than they meant. `smak check --publish <folder>`.
//
//   import { publishCheck } from "./smak/src/index.mjs";
//   const { errors, warnings, facts } = publishCheck("release/mymap", { game: "C:/.../Half-Life" });
//
// An error is one of:
//   - a file that is, byte for byte, one of the game's (a .wad, a model, a sound copied along);
//   - a texture of the game's .wad files inside a .wad or a .bsp of the folder (the same pixels and palette):
//     a map's own .wad made from the game's, or a compile with the game's textures put inside the map;
//   - a path into the person's own folder (their home, `C:\Users\<name>`, `/home/<name>`): in a text file, or a
//     map's entities (its `wad` key keeps the paths the editor had);
//   - a key or a token (GitHub, Anthropic, OpenAI, AWS, Slack, Google, a private key's block).
// A warning: another absolute path (`D:\Games\...` in a map's `wad` key), an archive over 50 MB, no readme.
//
// The game's files are found by size first: only those of a size a file of the folder has are read and hashed,
// so a game of gigabytes costs a walk of its folders. Its textures are every .wad under it, read once.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { readBsp, embeddedTexture } from "../core/maps/bsp.mjs";
import { readWad } from "../core/maps/wad.mjs";

/** Files smaller than this are not held against the game's: an empty file or a two-line text is anyone's. */
const SMALLEST = 256;
/** Files larger than this are not read for paths and keys (a video, a big archive). */
const LARGEST_READ = 32 * 1024 * 1024;
/** An archive over this is warned of: most places that take a map refuse it, and it is usually a mistake. */
const LARGE_ARCHIVE = 50 * 1024 * 1024;
const ARCHIVES = new Set([".zip", ".7z", ".rar", ".gz", ".tar"]);
/** Files read as text: a path in them is meant. In any other file only the person's own folder is looked for. */
const TEXT = new Set([".txt", ".md", ".cfg", ".json", ".map", ".rmf", ".fgd", ".qc", ".rad", ".res", ".script", ".mjs", ".js", ".html", ".htm", ".ini", ".lst", ".xml", ".csv", ".log", ".bat", ".sh", ".ps1"]); // prettier-ignore
/** Folders never looked in. */
const SKIPPED = new Set([".git", "node_modules"]);
/** Keys and tokens, by their shapes. */
const SECRETS = [
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["an Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ["an AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["a Google key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["a private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/],
];
/** A path into a person's own folder, on Windows, Linux or a Mac. */
const PERSONAL = /(?:\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/"'\s<>|*?:]+|\/home\/[^/"'\s<>|*?:]+|\/Users\/[^/"'\s<>|*?:]+)/i;
/** Any other absolute path on Windows. */
const ABSOLUTE = /\b[A-Za-z]:[\\/]+[^\\/"'\s<>|*?:;]+/;

const hashOf = (bytes) => createHash("sha1").update(bytes).digest("hex");
/** A texture as the game draws it: its first picture's pixels and its palette. */
const textureHash = (texture) =>
  createHash("sha1").update(texture.mips?.[0] ?? texture.pixels).update(texture.palette ?? Buffer.alloc(0)).digest("hex"); // prettier-ignore

/** Every file under a folder: `{ file, size }`, the folders of SKIPPED left out. */
function filesOf(folder, out = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name)) filesOf(file, out);
    } else if (entry.isFile()) out.push({ file, size: statSync(file).size });
  }
  return out;
}

/** The person's own folder as it is written in their files: with either slash, any case. */
function homesOf(home) {
  if (!home) return [];
  const forward = home.replace(/\\/g, "/").replace(/\/+$/, "");
  return [...new Set([forward, forward.replace(/\//g, "\\")])].map((each) => each.toLowerCase());
}

/** The textures of a .wad or a .bsp: `[{ name, hash }]`; nothing for a file that does not read as one. */
function texturesIn(file, bytes) {
  try {
    if (/\.wad$/i.test(file)) return readWad(bytes).textures.map((texture) => ({ name: texture.name, hash: textureHash(texture) })); // prettier-ignore
    if (/\.bsp$/i.test(file)) {
      const bsp = readBsp(bytes);
      return bsp.textures
        .map((entry, index) => (entry.embedded && !entry.absent ? embeddedTexture(bsp, index) : null))
        .filter(Boolean)
        .map((texture) => ({ name: texture.name, hash: textureHash(texture) }));
    }
  } catch {
    // a file that is not what its name says is no one's texture
  }
  return [];
}

/**
 * What in `folder` is not the person's to share: `{ errors, warnings, facts }`, each a list of sentences that
 * name the file. `game` is the game's folder (Half-Life's, or a mod's) to hold the files and textures against;
 * without it only paths, keys and the rest are looked for. `ours`: files in the game's folder that are the
 * person's own (a map of theirs installed there), as paths in it (`ts/maps/mymap.bsp`), not held against.
 * `home` is the person's own folder (the machine's unless told).
 */
export function publishCheck(folder, { game, ours = [], home = homedir() } = {}) {
  if (!existsSync(folder) || !statSync(folder).isDirectory())
    throw new Error(`publish: ${folder} is not a folder: give the folder that is to be shared`);
  const errors = [];
  const warnings = [];
  const facts = [];
  const files = filesOf(folder);
  const name = (file) => relative(folder, file).replace(/\\/g, "/");
  facts.push(`${files.length} files, ${(files.reduce((sum, each) => sum + each.size, 0) / 1048576).toFixed(1)} MB`);

  // ── the game's own files and textures
  if (game) {
    if (!existsSync(game)) throw new Error(`publish: the game's folder ${game} is not there`);
    const sizes = new Set(files.filter((each) => each.size >= SMALLEST).map((each) => each.size));
    const mine = new Set(ours.map((each) => each.replace(/\\/g, "/").toLowerCase()));
    const gameFiles = filesOf(game).filter((each) => !mine.has(relative(game, each.file).replace(/\\/g, "/").toLowerCase())); // prettier-ignore
    const bySize = new Map();
    for (const each of gameFiles) if (sizes.has(each.size)) bySize.set(each.size, [...(bySize.get(each.size) ?? []), each.file]); // prettier-ignore
    const hashes = new Map();
    const gameHash = (file) => hashes.get(file) ?? hashes.set(file, hashOf(readFileSync(file))).get(file);
    const copied = new Set();
    for (const each of files) {
      const same = each.size >= SMALLEST ? (bySize.get(each.size) ?? []) : [];
      if (!same.length) continue;
      const own = hashOf(readFileSync(each.file));
      const twin = same.find((file) => gameHash(file) === own);
      if (twin) {
        copied.add(each.file);
        errors.push(`${name(each.file)} is ${relative(game, twin).replace(/\\/g, "/")} of the game's folder, byte for byte: what the game has is not to be shared again (unless it is yours, put there)`); // prettier-ignore
      }
    }
    const gameTextures = new Map();
    // a texture several .wad files hold is named by Half-Life's own first (valve/), where the others had it from
    const wads = gameFiles.filter((one) => /\.wad$/i.test(one.file));
    const valveFirst = (one) => (/^valve[\\/]/i.test(relative(game, one.file)) ? 0 : 1);
    wads.sort((a, b) => valveFirst(a) - valveFirst(b));
    for (const each of wads)
      for (const texture of texturesIn(each.file, readFileSync(each.file)))
        if (!gameTextures.has(texture.hash)) gameTextures.set(texture.hash, `${relative(game, each.file).replace(/\\/g, "/")}'s ${texture.name}`); // prettier-ignore
    facts.push(`held against ${gameFiles.length} files of ${game}, and the ${gameTextures.size} textures of its .wad files`);
    for (const each of files.filter((one) => /\.(wad|bsp)$/i.test(one.file) && !copied.has(one.file))) {
      const theirs = texturesIn(each.file, readFileSync(each.file)).filter((texture) => gameTextures.has(texture.hash));
      if (theirs.length)
        errors.push(`${name(each.file)} holds ${theirs.length} of the game's textures: ${theirs.slice(0, 5).map((texture) => gameTextures.get(texture.hash)).join(", ")}${theirs.length > 5 ? ", ..." : ""}. A map names them and the game has them; a .wad or a map of yours holds only your own`); // prettier-ignore
    }
  }

  // ── paths, keys, archives
  const homes = homesOf(home);
  for (const each of files) {
    const ext = extname(each.file).toLowerCase();
    if (ARCHIVES.has(ext) && each.size > LARGE_ARCHIVE)
      warnings.push(`${name(each.file)} is an archive of ${(each.size / 1048576).toFixed(0)} MB: was it meant to be in it?`);
    if (each.size > LARGEST_READ) continue;
    const bytes = readFileSync(each.file);
    let text = bytes.toString("latin1");
    // a map's text is its entities: where its paths are
    if (ext === ".bsp")
      try {
        text = readBsp(bytes).entities.map((pairs) => pairs.map((pair) => `"${pair[0]}" "${pair[1]}"`).join("\n")).join("\n"); // prettier-ignore
      } catch {
        // read as bytes, as any other file
      }
    const lower = text.toLowerCase();
    const mine = homes.find((each) => lower.includes(each));
    const personal = PERSONAL.exec(text);
    if (mine || personal) {
      const at = mine ? lower.indexOf(mine) : personal.index;
      errors.push(`${name(each.file)} names a folder of the person's own: ${JSON.stringify(text.slice(at, at + 60).split(/["\r\n\0]/)[0])}`); // prettier-ignore
    } else if (TEXT.has(ext) || ext === ".bsp") {
      const absolute = ABSOLUTE.exec(text);
      if (absolute) warnings.push(`${name(each.file)} names an absolute path, ${JSON.stringify(absolute[0])}: a path on this machine means nothing on another`); // prettier-ignore
    }
    for (const [what, pattern] of SECRETS)
      if (pattern.test(text)) errors.push(`${name(each.file)} holds what looks like ${what}: take it out, and make a new one where it was used`); // prettier-ignore
  }
  if (!files.some((each) => /^readme/i.test(basename(each.file)) && relative(folder, each.file) === basename(each.file)))
    warnings.push("there is no readme: say what it is, what game it is for, and where its files go");
  return { errors, warnings, facts };
}
