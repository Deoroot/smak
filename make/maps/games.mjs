// Where the person's game is, and the kit's profiles by name: what lets `--mod ts` stand for
// profiles/specialists.mjs, made from the Half-Life folder found on the machine when no --game is given.
//
//   findHalfLife({ mod, env })  the installed Half-Life folder (the one that holds valve/ and the mods), or null
//   steamLibraries({ env })     the Steam library folders this machine has
//   MAP_PROFILES                the kit's map profiles by name: { name: [file in profiles/, the mod's folder] }
//   mapProfileOf(name)          a name's { file (an absolute path), folder }, or null for a name that is none
//
// Nothing here is read from the game: only whether its folders are there.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const PROFILES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "profiles");

/** The kit's map profiles by the names a person gives them: `--mod ts` is The Specialists'. */
export const MAP_PROFILES = {
  ts: ["specialists.mjs", "ts"],
  specialists: ["specialists.mjs", "ts"],
  msc: ["mastersword.mjs", "msc"],
  mastersword: ["mastersword.mjs", "msc"],
};

/** A profile named by one of MAP_PROFILES' names (any case): `{ file, folder }`, or null. */
export function mapProfileOf(name) {
  if (typeof name !== "string") return null;
  const known = MAP_PROFILES[name.toLowerCase()];
  return known ? { file: join(PROFILES, known[0]), folder: known[1] } : null;
}

const isFolder = (folder) => {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
};

/** Steam's own folder on this machine, by the registry (Windows) and the usual places; several may be tried. */
function steamRoots(env) {
  const roots = [];
  if (process.platform === "win32") {
    for (const key of ["HKCU\\Software\\Valve\\Steam", "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam"])
      try {
        const said = execFileSync("reg", ["query", key, "/v", key.startsWith("HKCU") ? "SteamPath" : "InstallPath"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }); // prettier-ignore
        const found = said.match(/REG_SZ\s+(.+?)\s*$/m)?.[1];
        if (found) roots.push(found);
      } catch {
        // no such key: Steam not installed by that name
      }
    for (const name of ["ProgramFiles(x86)", "ProgramFiles"]) if (env[name]) roots.push(join(env[name], "Steam"));
  } else {
    const home = env.HOME ?? homedir();
    roots.push(join(home, ".steam", "steam"), join(home, ".local", "share", "Steam"), join(home, "Library", "Application Support", "Steam")); // prettier-ignore
  }
  return [...new Set(roots.filter(isFolder))];
}

/**
 * The Steam library folders of this machine: each Steam folder, and those its `steamapps/libraryfolders.vdf`
 * names (a library on another drive).
 */
export function steamLibraries({ env = process.env } = {}) {
  const libraries = [];
  for (const root of steamRoots(env)) {
    libraries.push(root);
    const vdf = join(root, "steamapps", "libraryfolders.vdf");
    if (!existsSync(vdf)) continue;
    for (const [, path] of readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)) libraries.push(path.replace(/\\\\/g, "\\"));
  }
  // one folder written two ways (c:/games/steam, C:\Games\Steam) is one library
  const seen = new Set();
  return libraries.filter((folder) => {
    const key = process.platform === "win32" ? resolve(folder).toLowerCase() : resolve(folder);
    if (seen.has(key) || !isFolder(folder)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The installed Half-Life folder: `SMAK_HALF_LIFE` when it is set (empty or "none": no game is looked for), else
 * `steamapps/common/Half-Life` in a Steam library of this machine. With `mod` ("ts", "msc"), only a folder that
 * holds that mod's folder. Null when none is found.
 */
export function findHalfLife({ mod, env = process.env } = {}) {
  const fits = (folder) => isFolder(folder) && isFolder(join(folder, "valve")) && (!mod || isFolder(join(folder, mod)));
  if (env.SMAK_HALF_LIFE !== undefined) {
    const told = env.SMAK_HALF_LIFE.trim();
    return told && told.toLowerCase() !== "none" && fits(told) ? told : null;
  }
  for (const library of steamLibraries({ env })) {
    const folder = join(library, "steamapps", "common", "Half-Life");
    if (fits(folder)) return folder;
  }
  return null;
}
